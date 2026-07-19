import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EnrollFailurePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <XCircle className="w-10 h-10 mx-auto mb-4 text-destructive" />
        <p className="font-semibold mb-1">Payment didn't go through</p>
        <p className="text-sm text-muted-foreground mb-4">
          No charge was made. Your enrollment was still saved — you can pay from your parent portal, or ask the school about paying at the office instead.
        </p>
        <Link to="/portal"><Button variant="outline">Go to portal</Button></Link>
      </div>
    </div>
  );
}
