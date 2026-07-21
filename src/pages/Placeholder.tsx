import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

const Placeholder = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <>
    <PageHeader title={title} subtitle={subtitle} />
    <Card className="scroll-card">
      <CardContent className="p-12 text-center">
        <Construction className="h-12 w-12 mx-auto text-gold mb-4" />
        <h3 className="font-serif text-xl text-ink mb-2">该模块将在第二期上线</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          第一期已上线：评估对象管理、专家库管理、AI 评估报告生成。<br />
          第二期规划：工作组方案、资料收集、现场调研、AI 会议纪要分析、整改方案。
        </p>
      </CardContent>
    </Card>
  </>
);

export default Placeholder;
