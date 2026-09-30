import { RiderSignupForm } from "@/components/rider/signup-form";

/** Rider 顾客自助注册（**无门店上下文**的通用入口）。
 *  门店专属注册走 `/t/<slug>/signup` —— 那个入口把门店写进链接，注册直接落在对的店。 */
export default function RiderSignupPage() {
  return <RiderSignupForm />;
}
