import { ProgramContextShell } from "@/components/program-context-shell";

export const dynamic = "force-dynamic";

export default function ProgramWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <ProgramContextShell>{children}</ProgramContextShell>;
}
