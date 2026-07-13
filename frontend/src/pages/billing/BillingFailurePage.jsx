import { Link } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BillingFailurePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <XCircle className="w-10 h-10 mx-auto mb-4 text-red-500" />
        <p className="font-semibold mb-1">Payment cancelled or failed</p>
        <p className="text-sm text-muted-foreground mb-6">
          No charge was made. You can try again with the same or a different plan.
        </p>
        <Link to="/billing">
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">Back to plans</Button>
        </Link>
      </div>
    </div>
  );
}
