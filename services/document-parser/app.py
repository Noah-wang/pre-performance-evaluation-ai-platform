import base64
import email
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from threading import BoundedSemaphore
from pathlib import Path
from typing import Any

import fitz
import openpyxl
import pytesseract
from docx import Document
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image


app = FastAPI(title="Performance Document Parser", version="1.0.0")


class OcrRequest(BaseModel):
    fileName: str
    mimeType: str | None = None
    fileBase64: str
    maxChars: int | None = None
    maxPages: int | None = None
    timeBudgetSeconds: int | None = None
    # 从第几页开始解析（0 基）。长文档靠调用方分批推进，单次调用因此始终有界。
    startPage: int | None = None


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


MAX_CHARS = env_int("EXTRACT_TEXT_MAX_CHARS", 120_000, 12_000, 500_000)
MAX_PAGES = env_int("OCR_MAX_PAGES", 120, 1, 500)
OCR_MIN_CHARS = env_int("OCR_MIN_CHARS", 80, 0, 2_000)
OCR_DPI = env_int("OCR_DPI", 180, 96, 300)
OCR_LANG = os.getenv("OCR_LANG", "chi_sim+eng")
SOFFICE_BIN = os.getenv("SOFFICE_BIN", "libreoffice")
OCR_MAX_CONCURRENT = env_int("OCR_MAX_CONCURRENT", 1, 1, 4)
OCR_SEMAPHORE = BoundedSemaphore(OCR_MAX_CONCURRENT)
VISION_OCR_API_KEY = os.getenv("VISION_OCR_API_KEY", "").strip()
VISION_OCR_BASE_URL = os.getenv(
    "VISION_OCR_BASE_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
).strip()
VISION_OCR_MODEL = os.getenv("VISION_OCR_MODEL", "qwen-vl-ocr-latest").strip()
VISION_OCR_TIMEOUT_SECONDS = env_int("VISION_OCR_TIMEOUT_SECONDS", 90, 10, 240)
VISION_OCR_RETRIES = env_int("VISION_OCR_RETRIES", 1, 0, 3)
VISION_OCR_MIN_CONFIDENCE = env_int("VISION_OCR_MIN_CONFIDENCE", 55, 0, 100)
# prefer: 扫描页优先用视觉 OCR，tesseract 兜底（签章件/表格识别质量最好）
# fallback: 先 tesseract，识别不可信时才用视觉 OCR（省调用量）
# off: 只用 tesseract
VISION_OCR_MODE = os.getenv("VISION_OCR_MODE", "prefer").strip().lower()
VISION_OCR_MAX_PAGES = env_int("VISION_OCR_MAX_PAGES", 40, 0, 500)


def compact_text(value: str, max_chars: int = MAX_CHARS) -> str:
    text = re.sub(r"[ \t\r\f\v]+", " ", value or "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_chars]


def safe_suffix(file_name: str) -> str:
    suffix = Path(file_name or "").suffix.lower()
    if not re.match(r"^\.[a-z0-9]{1,8}$", suffix):
        return ".bin"
    return suffix


def ocr_image_path_with_confidence(image_path: Path) -> tuple[str, float]:
    with Image.open(image_path) as image:
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        data = pytesseract.image_to_data(
            image,
            lang=OCR_LANG,
            output_type=pytesseract.Output.DICT,
        )

    lines: list[str] = []
    current_line: tuple[int, int, int, int] | None = None
    tokens: list[str] = []
    confidence_total = 0.0
    confidence_weight = 0
    count = len(data.get("text", []))
    for index in range(count):
        token = str(data["text"][index] or "").strip()
        if not token:
            continue
        line_key = (
            int(data["page_num"][index]),
            int(data["block_num"][index]),
            int(data["par_num"][index]),
            int(data["line_num"][index]),
        )
        if current_line is not None and line_key != current_line and tokens:
            lines.append(" ".join(tokens))
            tokens = []
        current_line = line_key
        tokens.append(token)
        try:
            confidence = float(data["conf"][index])
        except (TypeError, ValueError):
            confidence = -1
        if confidence >= 0:
            weight = max(1, len(token))
            confidence_total += confidence * weight
            confidence_weight += weight
    if tokens:
        lines.append(" ".join(tokens))

    confidence = confidence_total / confidence_weight if confidence_weight else 0.0
    return "\n".join(lines).strip(), confidence


COORD_LINE_PATTERN = re.compile(r"^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*-?\d+\s*,\s*(.+)$")


def _flatten_json_cells(node: Any, lines: list[str]) -> None:
    if isinstance(node, list):
        cells = [
            str(item["text"]).strip()
            for item in node
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        if cells and len(cells) == len(node):
            line = " | ".join(cell for cell in cells if cell)
            if line:
                lines.append(line)
            return
        for item in node:
            _flatten_json_cells(item, lines)
        return
    if isinstance(node, dict):
        if isinstance(node.get("text"), str) and set(node).issubset({"text", "colspan", "rowspan"}):
            value = node["text"].strip()
            if value:
                lines.append(value)
            return
        for value in node.values():
            _flatten_json_cells(value, lines)


def _rebuild_rows_from_coordinates(records: list[tuple[int, int, int, str]]) -> str:
    """把 (x, y, 行高, 文本) 还原成阅读顺序：先按 y 分行，行内按 x 排列。"""
    rows: list[list[tuple[int, str]]] = []
    row_anchors: list[int] = []
    for x, y, height, text in sorted(records, key=lambda item: (item[1], item[0])):
        tolerance = max(8, int(height * 0.6))
        if row_anchors and abs(y - row_anchors[-1]) <= tolerance:
            rows[-1].append((x, text))
        else:
            rows.append([(x, text)])
            row_anchors.append(y)
    lines = []
    for row in rows:
        cells = [text for _x, text in sorted(row, key=lambda item: item[0]) if text]
        if cells:
            lines.append(" | ".join(cells) if len(cells) > 1 else cells[0])
    return "\n".join(lines)


def normalize_vision_ocr_output(text: str) -> str:
    """视觉 OCR 会按图像内容返回纯文本、JSON 表格或带坐标的识别结果。

    报告端只消费纯文本，JSON 括号和坐标数字既占用上下文，又会被事实抽取误当成
    数量指标，所以统一摊平成“单元格 | 单元格”的行文本。
    """
    raw = (text or "").strip()
    if not raw:
        return ""

    fenced = re.match(r"^```[A-Za-z]*\s*(.+?)\s*```$", raw, re.S)
    if fenced:
        raw = fenced.group(1).strip()

    if raw[:1] in "{[":
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            pass
        else:
            lines: list[str] = []
            _flatten_json_cells(parsed, lines)
            if lines:
                return "\n".join(lines)

    source_lines = [line for line in raw.splitlines() if line.strip()]
    records: list[tuple[int, int, int, str]] = []
    for line in source_lines:
        match = COORD_LINE_PATTERN.match(line)
        if match:
            records.append((
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
                match.group(5).strip(),
            ))
    if source_lines and len(records) >= max(3, int(len(source_lines) * 0.6)):
        rebuilt = _rebuild_rows_from_coordinates(records)
        if rebuilt:
            return rebuilt

    if "<" in raw and re.search(r"</?(?:table|tr|td|th|div|p)\b", raw, re.I):
        return html_to_text(raw)

    return raw


TRANSCRIBE_PROMPT = (
    "Transcribe this image into HTML. Convert every table using <tr> and <td> "
    "tags, following the layout from top-left to bottom-right, and represent "
    "merged cells accurately. Keep each cell's full text inside a single <td>: "
    "join text that wraps onto several lines within the same cell, and never "
    "split one cell across rows. Never merge two neighbouring cells into one "
    "<td>: an indicator name and its target value must stay in separate <td> "
    "cells of the same <tr>, so that every value lines up with the indicator it "
    "belongs to. Transcribe text outside tables as <p> blocks. "
    "Do not omit or summarise any cell, including long goal descriptions. "
    "Keep numbers, decimal points and units written together without spaces "
    "(for example 90.2万元, 13969.56标箱, 99%). Transcribe only what is visible, "
    "never guess or add content, and output the HTML with no commentary."
)

def _vision_ocr_request(image_path: Path, prompt: str) -> str:
    if not VISION_OCR_API_KEY or not VISION_OCR_BASE_URL:
        return ""

    with Image.open(image_path) as image:
        if image.mode != "RGB":
            image = image.convert("RGB")
        # 政府绩效表格的字号很小，分辨率不足时模型会把相邻单元格并成一格，
        # 导致指标与指标值错位，因此尽量保留细节。
        limit = env_int("VISION_OCR_IMAGE_MAX_SIDE", 3_200, 1_024, 4_096)
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=95, optimize=True)

    data_url = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    payload = {
        "model": VISION_OCR_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                # 这个模型在 OpenAI 兼容模式下只能靠提示词选择 OCR 任务：自由发挥的
                # 中文提示会让它退回“按视觉行输出坐标”，把单元格内换行的指标名拆散，
                # 导致绩效目标抽取失效。
                {"type": "text", "text": prompt},
            ],
        }],
        "max_tokens": env_int("VISION_OCR_MAX_TOKENS", 8_192, 1_024, 32_768),
    }
    request = urllib.request.Request(
        VISION_OCR_BASE_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {VISION_OCR_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    # 单次网络抖动就退回 tesseract 会让整页质量断崖式下降，值得重试一次。
    result = None
    for attempt in range(VISION_OCR_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=VISION_OCR_TIMEOUT_SECONDS) as response:
                result = json.load(response)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            detail = ""
            if isinstance(exc, urllib.error.HTTPError):
                try:
                    detail = f" HTTP {exc.code}: {exc.read()[:300].decode('utf-8', 'ignore')}"
                except Exception:  # noqa: BLE001 - 诊断信息尽力而为
                    detail = f" HTTP {exc.code}"
            elif isinstance(exc, urllib.error.URLError):
                detail = f" reason={exc.reason!r}"
            print(
                f"vision OCR attempt {attempt + 1} failed: {type(exc).__name__}{detail}",
                flush=True,
            )
            if attempt >= VISION_OCR_RETRIES:
                return ""
            time.sleep(1.5)
    if result is None:
        return ""

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("text")
        )
    return str(content or "").strip()


def vision_ocr_image_path(image_path: Path) -> str:
    return normalize_vision_ocr_output(_vision_ocr_request(image_path, TRANSCRIBE_PROMPT))


def html_to_text(value: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", value or "")
    text = re.sub(r"(?i)</\s*(?:tr|table|div|p|h[1-6]|li)\s*>", "\n", text)
    text = re.sub(r"(?i)<\s*br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</\s*(?:td|th)\s*>", " | ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = re.sub(r"[ \t]*\|[ \t]*(?=\n|$)", "", text)
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def read_docx_alt_chunks(path: Path) -> str:
    """读取 Word 的 altChunk 正文（word/afchunk.mht 等）。

    由 HTML 转存的 .docx 会把整篇正文塞进 altChunk，document.xml 里只留一个引用，
    只读 document.xml 会得到一份空文档——文件看着有十几 KB，却一个字都取不到。
    """
    try:
        with zipfile.ZipFile(path) as archive:
            names = [
                name for name in archive.namelist()
                if re.search(r"\.(?:mht|mhtml|html?)$", name, re.I)
            ]
            parts: list[str] = []
            for name in names:
                raw = archive.read(name).decode("utf-8", "ignore")
                if re.search(r"^\s*(?:MIME-Version|Content-Type):", raw, re.I | re.M):
                    message = email.message_from_string(raw)
                    for chunk in message.walk():
                        if chunk.get_content_type() not in ("text/html", "text/plain"):
                            continue
                        payload = chunk.get_payload(decode=True) or b""
                        decoded = payload.decode(chunk.get_content_charset() or "utf-8", "ignore")
                        parts.append(
                            html_to_text(decoded)
                            if chunk.get_content_type() == "text/html"
                            else decoded
                        )
                else:
                    parts.append(html_to_text(raw))
            return "\n".join(part for part in parts if part.strip())
    except (zipfile.BadZipFile, KeyError, OSError) as exc:
        print(f"docx altChunk extraction failed: {type(exc).__name__}", flush=True)
        return ""


def read_docx(path: Path) -> str:
    document = Document(path)
    parts: list[str] = []
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            parts.append(paragraph.text)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    text = "\n".join(parts)
    return text if text.strip() else read_docx_alt_chunks(path)


def read_xlsx(path: Path) -> str:
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    max_rows = env_int("SHEET_EXTRACT_MAX_ROWS", 2_000, 100, 50_000)
    parts: list[str] = []
    for sheet in workbook.worksheets:
        parts.append(f"[工作表] {sheet.title}")
        for index, row in enumerate(sheet.iter_rows(values_only=True)):
            if index >= max_rows:
                parts.append(f"[提示] 工作表超过 {max_rows} 行，后续行未纳入索引。")
                break
            cells = [str(cell).strip() for cell in row if cell not in (None, "")]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def render_page_to_png(page: fitz.Page, out_path: Path) -> None:
    zoom = OCR_DPI / 72
    matrix = fitz.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    pixmap.save(out_path)


def looks_garbled_text(text: str) -> bool:
    if len(text) < OCR_MIN_CHARS:
        return False
    hangul_count = len(re.findall(r"[\uac00-\ud7af]", text))
    replacement_count = text.count("�")
    visible_count = len(re.sub(r"\s+", "", text))
    if not visible_count:
        return False
    meaningful_count = len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9，。；：、（）()《》%％./\-—]", text))
    symbol_noise_count = len(re.findall(r"[!\"#$&'()*+,;<=>?@\\^_`{|}~]{3,}", text))
    return (
        (hangul_count / visible_count) > 0.02
        or (replacement_count / visible_count) > 0.01
        or (meaningful_count / visible_count) < 0.48
        or symbol_noise_count >= 2
    )


def looks_meaningful_ocr(text: str) -> bool:
    visible_count = len(re.sub(r"\s+", "", text or ""))
    if visible_count < 8:
        return False
    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", text or ""))
    hangul_count = len(re.findall(r"[\uac00-\ud7af]", text or ""))
    if hangul_count > chinese_count:
        return False
    if chinese_count >= 4:
        return (chinese_count / visible_count) >= 0.16
    latin_words = re.findall(r"\b[A-Za-z]{3,}\b", text or "")
    return len(latin_words) >= 5


def ocr_page_best_effort(image_path: Path, allow_vision: bool) -> tuple[str, str]:
    """识别一页扫描件，返回 (正文, 使用的引擎)。

    视觉 OCR 对签章件、印章遮挡和中文表格的识别质量远高于 tesseract，因此在配置
    可用时由它主导；tesseract 保留为离线兜底，两者都不可信时取更长的那份。
    """
    vision_text = ""
    if allow_vision and VISION_OCR_MODE == "prefer":
        vision_text = vision_ocr_image_path(image_path)
        if looks_meaningful_ocr(vision_text):
            return vision_text, "vision"

    tesseract_text, confidence = ocr_image_path_with_confidence(image_path)
    if confidence >= VISION_OCR_MIN_CONFIDENCE and looks_meaningful_ocr(tesseract_text):
        return tesseract_text, "tesseract"

    if allow_vision and not vision_text:
        vision_text = vision_ocr_image_path(image_path)
    if looks_meaningful_ocr(vision_text) and len(vision_text) >= len(tesseract_text):
        return vision_text, "vision"
    if looks_meaningful_ocr(tesseract_text):
        return tesseract_text, "tesseract"
    return "", "none"


ROW_SLICING = os.getenv("VISION_OCR_ROW_SLICING", "true").strip().lower() == "true"
ROW_SLICE_MAX_BANDS = env_int("VISION_OCR_ROW_SLICE_MAX_BANDS", 6, 2, 12)

ROW_PROMPT = (
    "Transcribe this table fragment into HTML using <tr> and <td>. Each printed row "
    "becomes one <tr>, and the indicator name and its target value go into separate "
    "<td> cells of that same row. Never merge two printed rows into one <tr>. "
    "Keep numbers and units together without spaces. Output only the HTML."
)


def detect_row_bands(image_path: Path) -> list[tuple[int, int]]:
    """按表格横线把整页切成行带。

    整页交给模型时，它会把纵向相邻的多个单元格并进同一个 <td>，指标名与指标值因此
    错位。先按横线切开，单元格就跨不出所在的行带，配对关系由切割保证而不是靠模型
    自觉。用水平投影找横线：表格线在整行上都是深色像素，正文行不会。
    """
    with Image.open(image_path) as image:
        gray = image.convert("L")
        width, height = gray.size
        pixels = gray.load()
        step = max(1, width // 400)
        columns = list(range(0, width, step))
        ratios = [
            sum(1 for x in columns if pixels[x, y] < 128) / len(columns)
            for y in range(height)
        ]

    # 表格线的深浅随扫描质量变化很大，固定阈值会漏掉浅色线。改成按本页最深的
    # 那条线取相对阈值。
    peak = max(ratios) if ratios else 0.0
    threshold = max(0.28, peak * 0.6)

    separators: list[int] = []
    run_start: int | None = None
    for y, ratio in enumerate(ratios + [0.0]):
        if ratio > threshold:
            if run_start is None:
                run_start = y
        elif run_start is not None:
            separators.append((run_start + y - 1) // 2)
            run_start = None

    print(
        f"row-band detect: peak={peak:.2f} threshold={threshold:.2f} separators={len(separators)}",
        flush=True,
    )
    if len(separators) < 3:
        return []

    min_band = max(40, height // (ROW_SLICE_MAX_BANDS * 3))
    bounds = [0] + separators + [height]
    bands: list[tuple[int, int]] = []
    for top, bottom in zip(bounds, bounds[1:]):
        if bottom - top < min_band and bands:
            bands[-1] = (bands[-1][0], bottom)
        elif bottom - top >= min_band:
            bands.append((top, bottom))

    # 带数过多就按顺序合并相邻带，控制调用量
    while len(bands) > ROW_SLICE_MAX_BANDS:
        merged: list[tuple[int, int]] = []
        for index in range(0, len(bands), 2):
            pair = bands[index:index + 2]
            merged.append((pair[0][0], pair[-1][1]))
        bands = merged
    return bands if len(bands) >= 2 else []


def vision_ocr_by_row_bands(image_path: Path, tmpdir: Path, deadline: float) -> str:
    bands = detect_row_bands(image_path)
    if not bands:
        return ""
    parts: list[str] = []
    with Image.open(image_path) as image:
        width = image.size[0]
        for index, (top, bottom) in enumerate(bands):
            if time.monotonic() >= deadline - 12:
                break
            crop_path = tmpdir / f"{image_path.stem}-band-{index}.png"
            image.crop((0, max(0, top - 4), width, min(image.size[1], bottom + 4))).save(crop_path)
            text = normalize_vision_ocr_output(_vision_ocr_request(crop_path, ROW_PROMPT))
            if text.strip():
                parts.append(text.strip())
    combined = "\n".join(parts)
    print(f"row-band OCR: {len(bands)} bands, {len(combined)} chars", flush=True)
    return combined if looks_meaningful_ocr(combined) else ""


def read_pdf(
    path: Path,
    tmpdir: Path,
    max_pages: int | None = None,
    time_budget_seconds: int | None = None,
    start_page: int = 0,
) -> tuple[str, list[dict[str, Any]], str, dict[str, int | None]]:
    document = fitz.open(path)
    page_records: list[dict[str, Any]] = []
    text_parts: list[str] = []
    used_ocr = False
    engines_used: set[str] = set()
    vision_pages_used = 0
    page_limit = max(1, min(MAX_PAGES, max_pages or MAX_PAGES))
    total_pages = len(document)
    start_page = max(0, min(start_page, max(0, total_pages - 1)))
    pages_to_read = min(total_pages, start_page + page_limit)
    started_at = time.monotonic()
    deadline = started_at + max(10, min(240, time_budget_seconds or 90))

    last_page_done = start_page - 1
    for page_index in range(start_page, pages_to_read):
        if time.monotonic() >= deadline:
            break

        page = document[page_index]
        page_text = page.get_text("text").strip()
        page_text_is_garbled = looks_garbled_text(page_text)
        # OCR is expensive. If time is nearly exhausted, keep text-layer output and
        # return a usable partial index instead of timing out the whole request.
        has_time_for_ocr = time.monotonic() < deadline - 8
        if (len(page_text) < OCR_MIN_CHARS or page_text_is_garbled) and has_time_for_ocr:
            image_path = tmpdir / f"page-{page_index + 1}.png"
            render_page_to_png(page, image_path)
            # 视觉 OCR 是一次外部调用，比 tesseract 慢，也按页计费，因此受时间预算
            # 和页数上限约束；超出后本页自动退回 tesseract。
            allow_vision = (
                VISION_OCR_MODE != "off"
                and bool(VISION_OCR_API_KEY)
                and vision_pages_used < VISION_OCR_MAX_PAGES
                and time.monotonic() < deadline - 12
            )
            ocr_text, engine = ocr_page_best_effort(image_path, allow_vision)
            if engine == "vision":
                vision_pages_used += 1
                # 整页识别会把纵向相邻单元格并成一格（指标名与指标值因此错位）。
                # 页面有表格横线时再按行带切一遍，用切割保证配对关系。
                if ROW_SLICING:
                    banded = vision_ocr_by_row_bands(image_path, tmpdir, deadline)
                    if len(banded) > len(ocr_text) * 0.6:
                        ocr_text = banded
            if page_text_is_garbled and not ocr_text:
                page_text = ""
            elif ocr_text and (page_text_is_garbled or len(ocr_text) > len(page_text)):
                page_text = ocr_text
                used_ocr = True
                engines_used.add(engine)

        last_page_done = page_index
        if page_text:
            text_parts.append(f"[第{page_index + 1}页]\n{page_text}")
            page_records.append({"page": page_index + 1, "chars": len(page_text)})


    next_start = last_page_done + 1
    progress = {
        "totalPages": total_pages,
        "startPage": start_page,
        "nextStartPage": next_start if next_start < total_pages else None,
    }
    if not used_ocr:
        method = "pdf-text"
    elif "vision" in engines_used:
        method = "pdf+vision-ocr" if len(engines_used) == 1 else "pdf+vision-ocr+tesseract"
    else:
        method = "pdf+ocr"
    return "\n\n".join(text_parts), page_records, method, progress


def convert_with_libreoffice(path: Path, out_dir: Path, target: str = "pdf") -> Path | None:
    result = subprocess.run(
        [
            SOFFICE_BIN,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            target,
            "--outdir",
            str(out_dir),
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=90,
        check=False,
    )
    if result.returncode != 0:
        return None
    candidates = sorted(out_dir.glob(f"*.{target.split(':', 1)[0]}"))
    return candidates[0] if candidates else None


def extract_text(
    path: Path,
    file_name: str,
    tmpdir: Path,
    max_pages: int | None = None,
    time_budget_seconds: int | None = None,
    start_page: int = 0,
) -> tuple[str, str, list[dict[str, Any]], dict[str, int | None]]:
    suffix = safe_suffix(file_name)
    pages: list[dict[str, Any]] = []
    # 单次即可读完的类型：没有分页概念，进度直接标记为完成。
    done: dict[str, int | None] = {"totalPages": 1, "startPage": 0, "nextStartPage": None}

    if suffix == ".pdf":
        text, pages, method, progress = read_pdf(path, tmpdir, max_pages, time_budget_seconds, start_page)
        return text, method, pages, progress

    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        allow_vision = VISION_OCR_MODE != "off" and bool(VISION_OCR_API_KEY)
        text, engine = ocr_page_best_effort(path, allow_vision)
        return text, f"image-{engine}-ocr" if engine != "none" else "image-ocr", pages, done

    if suffix == ".docx":
        return read_docx(path), "docx", pages, done

    if suffix in {".xlsx", ".xlsm", ".xltx", ".xltm"}:
        return read_xlsx(path), "xlsx", pages, done

    if suffix in {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"}:
        return path.read_text(encoding="utf-8", errors="ignore"), "plain-text", pages, done

    if suffix in {".doc", ".ppt", ".pptx", ".xls"}:
        converted = convert_with_libreoffice(path, tmpdir, "pdf")
        if converted:
            text, pages, method, progress = read_pdf(converted, tmpdir, max_pages, time_budget_seconds, start_page)
            return text, f"libreoffice-{method}", pages, progress

    try:
        return path.read_text(encoding="utf-8", errors="ignore"), "plain-text-fallback", pages, done
    except Exception:
        return "", "unsupported", pages, done


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "ocrLang": OCR_LANG,
        "ocrMaxConcurrent": OCR_MAX_CONCURRENT,
        "visionOcr": bool(VISION_OCR_API_KEY),
        "visionOcrModel": VISION_OCR_MODEL if VISION_OCR_API_KEY else None,
        "visionOcrMinConfidence": VISION_OCR_MIN_CONFIDENCE,
        "visionOcrMode": VISION_OCR_MODE,
        "visionOcrMaxPages": VISION_OCR_MAX_PAGES,
        "maxPages": MAX_PAGES,
        "maxChars": MAX_CHARS,
        "libreoffice": shutil.which(SOFFICE_BIN) is not None,
    }


@app.post("/ocr")
def ocr(payload: OcrRequest) -> dict[str, Any]:
    try:
        raw = base64.b64decode(payload.fileBase64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid fileBase64") from exc

    max_chars = max(12_000, min(500_000, payload.maxChars or MAX_CHARS))

    with tempfile.TemporaryDirectory() as temp_root:
        tmpdir = Path(temp_root)
        input_path = tmpdir / f"input{safe_suffix(payload.fileName)}"
        input_path.write_bytes(raw)
        max_pages = max(1, min(MAX_PAGES, payload.maxPages or MAX_PAGES))
        time_budget_seconds = max(10, min(240, payload.timeBudgetSeconds or 90))
        with OCR_SEMAPHORE:
            text, method, pages, progress = extract_text(
                input_path, payload.fileName, tmpdir, max_pages, time_budget_seconds,
                max(0, payload.startPage or 0),
            )
        text = compact_text(text, max_chars)
        return {
            "text": text,
            "result": text,
            "content": text,
            "method": method,
            "chars": len(text),
            "pages": pages,
            "totalPages": progress.get("totalPages"),
            "startPage": progress.get("startPage"),
            "nextStartPage": progress.get("nextStartPage"),
        }
