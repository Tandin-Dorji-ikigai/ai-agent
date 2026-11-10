"use client";

import { Leaf } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/components/sign-in-form";

/** The general sign-in page: YDF staff, the team, or anyone who arrives here first. */
export function AccessForm() {
  return (
    <main className="login-screen">
      <p className="brand mb-5">
        <span className="brand-icon">
          <Leaf className="size-5" />
        </span>
        <span>mentorflow</span>
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            This test version is password protected. Enter the password the team gave you: the entrepreneur, mentor, YDF staff or team password. It decides which screens
            this device can open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
