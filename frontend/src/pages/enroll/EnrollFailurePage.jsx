import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/lib/useSEO";

export default function EnrollFailurePage() {
  useSEO({ title: "Scolaris", noindex: true });
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <XCircle className="w-10 h-10 mx-auto mb-4 text-destructive" />
        <p className="font-semibold mb-1">لم تتم عملية الدفع</p>
        <p className="text-sm text-muted-foreground mb-4">
          لم يتم أي خصم. تسجيلك محفوظ رغم ذلك — يمكنك الدفع من بوابة الأولياء، أو الاستفسار من المدرسة حول الدفع في المكتب.
        </p>
        <Link to="/portal"><Button variant="outline">الذهاب إلى البوابة</Button></Link>
      </div>
    </div>
  );
}
