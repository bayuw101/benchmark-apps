/** Runs section: the page plus a `sheet` slot. Only `/runs/new` reached in-app fills the slot (Create run sheet). */
export default function RunsLayout({ children, sheet }: { children: React.ReactNode; sheet: React.ReactNode }) {
  return (
    <>
      {children}
      {sheet}
    </>
  );
}
