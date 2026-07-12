import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AuthLayout from "./AuthLayout";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AUTH } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/lib/api";
import { Loader2 } from "lucide-react";

const CENTER_TYPES = [
  { value: "tutoring", label: "Tutoring center" },
  { value: "language", label: "Language school" },
  { value: "coding", label: "Coding academy" },
  { value: "robotics", label: "Robotics club" },
  { value: "music", label: "Music school" },
  { value: "art", label: "Art school" },
  { value: "camp", label: "Summer camp" },
  { value: "professional", label: "Professional training" },
  { value: "other", label: "Other" },
];

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
}

export default function RegisterPage() {
  const { register, user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [slug, setSlug] = useState("");
  const [centerType, setCenterType] = useState("tutoring");
  const [busy, setBusy] = useState(false);

  if (user) {
    nav("/app", { replace: true });
    return null;
  }

  const onWorkspaceChange = (v) => {
    setWorkspaceName(v);
    if (!slug || slug === slugify(workspaceName)) {
      setSlug(slugify(v));
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await register({
        tenant_name: workspaceName.trim(),
        tenant_slug: slug.trim(),
        center_type: centerType,
        name: name.trim(),
        email: email.trim(),
        password,
      });
      toast.success("Workspace created! Welcome to SchoolDZ.");
      nav("/app", { replace: true });
    } catch (err) {
      toast.error(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t("nav.signup")}
      subtitle="14-day free trial. No credit card."
      footer={
        <>
          {t("auth.have_account")}{" "}
          <Link to="/login" className="font-semibold text-foreground hover:text-accent" data-testid="auth-goto-login">
            {t("auth.submit.login")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ws">{t("auth.workspace_name")}</Label>
            <Input
              id="ws"
              value={workspaceName}
              onChange={(e) => onWorkspaceChange(e.target.value)}
              required
              data-testid={AUTH.registerWorkspaceName}
              className="h-11"
              placeholder="DT Educ"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">{t("auth.tenant_slug")}</Label>
            <div className="flex items-center h-11 rounded-md border border-input bg-background overflow-hidden">
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                required
                data-testid={AUTH.registerWorkspaceSlug}
                className="h-11 border-0 font-mono focus-visible:ring-0"
                placeholder="dteduc"
              />
              <span className="px-3 text-xs font-mono text-muted-foreground border-s border-border h-full grid place-items-center whitespace-nowrap">
                .schooldz.com
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">{t("auth.center_type")}</Label>
          <Select value={centerType} onValueChange={setCenterType}>
            <SelectTrigger data-testid={AUTH.registerCenterType} className="h-11 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {CENTER_TYPES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border-t border-border pt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("auth.your_name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              data-testid={AUTH.registerName}
              className="h-11"
              placeholder="John Doe"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid={AUTH.registerEmail}
                className="h-11"
                placeholder="you@school.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd">{t("auth.password")}</Label>
              <Input
                id="pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                data-testid={AUTH.registerPassword}
                className="h-11"
                placeholder="At least 6 characters"
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={busy}
          data-testid={AUTH.registerSubmit}
          className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.submit.register")}
        </Button>
      </form>
    </AuthLayout>
  );
}
