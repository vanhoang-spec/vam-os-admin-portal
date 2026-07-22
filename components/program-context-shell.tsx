import { ProgramSwitcher } from "@/components/program-switcher";
import { resolveAuthorizedContextOptions } from "@/lib/program-context-options";

export async function ProgramContextShell({ children }: { children: React.ReactNode }) {
  const options = await resolveAuthorizedContextOptions();
  return (
    <>
      <div className="mb-4 flex justify-end">
        <ProgramSwitcher options={options} />
      </div>
      {children}
    </>
  );
}
