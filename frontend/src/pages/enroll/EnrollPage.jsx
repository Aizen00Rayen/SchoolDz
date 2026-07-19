import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Users } from "lucide-react";

import { api, extractError, resolveFileUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Field } from "@/pages/app/_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DEFAULT_FORM = {
  guardian_name: "", guardian_email: "", guardian_phone: "", password: "",
  student_first_name: "", student_last_name: "", group_id: "", payment_method: "office",
};

export default function EnrollPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { loginWithToken } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [selectedCourseId, setSelectedCourseId] = useState(null);

  const { data: school, isLoading, isError } = useQuery({
    queryKey: ["public-school", slug],
    queryFn: async () => (await api.get(`/public/schools/${slug}`)).data,
    retry: false,
  });

  const courses = school?.courses || [];
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];

  // Derived rather than synced into state via an effect: a course with only
  // one open group shouldn't need an extra click on a dropdown that already
  // shows its one option. An explicit user choice (form.group_id) always
  // wins; this is purely the fallback when nothing's been picked yet.
  const effectiveGroupId = form.group_id || selectedCourse?.groups.find((g) => g.seats_left > 0)?.id || "";

  const enrollMut = useMutation({
    mutationFn: (payload) => api.post(`/public/schools/${slug}/enroll`, payload).then((r) => r.data),
    onSuccess: async (data) => {
      if (data.payment_error) toast.warning(data.payment_error);
      // Log in first in both cases — the success/failure pages after a
      // Chargily redirect require an authenticated parent portal session.
      await loginWithToken(data.access_token, data.user);
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      toast.success(`${data.student.first_name} is enrolled!`);
      nav("/portal", { replace: true });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!effectiveGroupId) {
      toast.error("Choose a course group first.");
      return;
    }
    enrollMut.mutate({ ...form, group_id: effectiveGroupId });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !school) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-center px-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">School not found</h1>
          <p className="text-muted-foreground">Double-check the link you were given.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center gap-4">
          {school.logo_url ? (
            <img src={resolveFileUrl(school.logo_url)} alt={school.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-14 h-14 rounded-xl grid place-items-center flex-shrink-0 text-white font-bold text-xl"
              style={{ backgroundColor: school.primary_color || "#0A0A0B" }}
            >
              {school.name?.[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{school.name}</h1>
            {school.enrollment_description && (
              <p className="text-muted-foreground text-sm mt-1 max-w-xl">{school.enrollment_description}</p>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-5 gap-10">
        {/* Course picker */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Choose a course
          </h2>
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses are open for enrollment right now — please contact the school directly.</p>
          ) : (
            <div className="space-y-3">
              {courses.map((c) => {
                const totalSeats = c.groups.reduce((s, g) => s + g.seats_left, 0);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedCourseId(c.id); setForm((f) => ({ ...f, group_id: "" })); }}
                    className={`w-full text-start rounded-xl border p-4 transition-colors ${
                      selectedCourse?.id === c.id ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="font-semibold">{c.title}</span>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground mb-2">{c.description}</p>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{c.duration_weeks} weeks</span>
                      <span className="font-mono font-semibold text-foreground">
                        {Number(c.price).toLocaleString()} {school.currency}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                      <Users className="w-3 h-3" />
                      {totalSeats > 0 ? `${totalSeats} seat${totalSeats > 1 ? "s" : ""} left` : "Full"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Enrollment form */}
        <div className="lg:col-span-3">
          {selectedCourse && (
            <form onSubmit={onSubmit} className="space-y-5 surface-card p-6">
              <Field label="Group" required>
                <Select value={effectiveGroupId} onValueChange={(v) => setForm((f) => ({ ...f, group_id: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Pick a group" /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {selectedCourse.groups.map((g) => (
                      <SelectItem key={g.id} value={g.id} disabled={g.seats_left === 0}>
                        {g.name}{g.schedule ? ` · ${g.schedule}` : ""} — {g.seats_left === 0 ? "Full" : `${g.seats_left} left`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Student first name" required>
                  <Input value={form.student_first_name} onChange={(e) => setForm((f) => ({ ...f, student_first_name: e.target.value }))} required />
                </Field>
                <Field label="Student last name" required>
                  <Input value={form.student_last_name} onChange={(e) => setForm((f) => ({ ...f, student_last_name: e.target.value }))} required />
                </Field>
              </div>

              <Field label="Your name (parent/guardian)" required>
                <Input value={form.guardian_name} onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))} required />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Email" required>
                  <Input type="email" value={form.guardian_email} onChange={(e) => setForm((f) => ({ ...f, guardian_email: e.target.value }))} required />
                </Field>
                <Field label="Phone">
                  <Input value={form.guardian_phone} onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))} />
                </Field>
              </div>

              <Field label="Choose a password" required>
                <Input
                  type="password" minLength={8} value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required placeholder="At least 8 characters"
                />
              </Field>
              <p className="text-xs text-muted-foreground -mt-3">
                This becomes your login for the parent portal, where you'll see attendance, grades, and payments.
              </p>

              <Field label="How would you like to pay?" required>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm ${form.payment_method === "online" ? "border-foreground" : "border-border"}`}>
                    <input type="radio" name="payment_method" checked={form.payment_method === "online"} onChange={() => setForm((f) => ({ ...f, payment_method: "online" }))} />
                    Pay online now
                  </label>
                  <label className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm ${form.payment_method === "office" ? "border-foreground" : "border-border"}`}>
                    <input type="radio" name="payment_method" checked={form.payment_method === "office"} onChange={() => setForm((f) => ({ ...f, payment_method: "office" }))} />
                    Pay at the office
                  </label>
                </div>
              </Field>

              <Button type="submit" className="w-full h-11" disabled={enrollMut.isPending}>
                {enrollMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : form.payment_method === "online" ? (
                  <>Continue to payment</>
                ) : (
                  <><Check className="w-4 h-4 me-2" /> Enroll</>
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
