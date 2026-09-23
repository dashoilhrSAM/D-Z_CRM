"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateRiderProfile } from "@/actions/rider-profile";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export interface RiderProfileInitial {
  name: string;
  phone: string;
  email: string;
  gender: string;
  address: string;
}

const GENDERS = ["", "M", "F"];

/** Rider 个人资料编辑表单（Settings → Profile）。 */
export function ProfileForm({ initial }: { customerId?: string; initial: RiderProfileInitial }) {
  const router = useRouter();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial.name);
  const [phone] = useState(initial.phone); // 只读：改号走验证流程
  const [email, setEmail] = useState(initial.email);
  const [gender, setGender] = useState(initial.gender);
  const [address, setAddress] = useState(initial.address);

  const submit = () =>
    start(async () => {
      const r = await updateRiderProfile({ name, phone, email, gender, address });
      if (r.ok) {
        toast.success(t("toast.saved", lang));
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-3">
      <div>
        <Label>{t("common.name", lang)}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder={t("profile.name-placeholder", lang)} />
      </div>
      {/* 手机号在这里**只读**：它是登录标识，改号要先验证新号码（Settings → 手机号码）。
          服务端 updateRiderProfile 也会拒绝直接改号，UI 只是不让人白填一遍。 */}
      <div>
        <Label>{t("common.phone", lang)}</Label>
        <Input value={phone} readOnly disabled className="mt-1.5" inputMode="tel" />
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.phone-readonly-hint", lang)}</p>
      </div>
      <div>
        <Label>{t("common.email", lang)}</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" placeholder="you@email.com" />
      </div>
      <div>
        <Label>{t("form.gender", lang)}</Label>
        <select value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
          {GENDERS.map((g) => (
            <option key={g || "unset"} value={g}>{g ? g : t("form.prefer-not", lang)}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>{t("form.address", lang)}</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1.5" placeholder={t("profile.address-placeholder", lang)} />
      </div>
      <Button className="w-full" disabled={pending || !name.trim()} onClick={submit}>
        {pending ? t("form.saving", lang) : t("profile.save-changes", lang)}
      </Button>
    </div>
  );
}
