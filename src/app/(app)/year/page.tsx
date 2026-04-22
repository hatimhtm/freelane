import { redirect } from "next/navigation";

export default function YearIndex() {
  redirect(`/year/${new Date().getFullYear()}`);
}
