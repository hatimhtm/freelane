"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HIDDEN_OWNER_EMAIL } from "@/lib/constants";

export async function login(password: string) {
  if (!password) return { error: "Enter the password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: HIDDEN_OWNER_EMAIL,
    password,
  });

  if (error) return { error: "That's not it. Try again." };
  redirect("/dashboard");
}
