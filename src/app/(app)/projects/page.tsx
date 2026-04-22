import { Plus, KanbanSquare } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getProjectsWithClients } from "@/lib/data/queries";
import { KanbanBoard } from "./_components/kanban-board";
import { ProjectNewButton } from "./_components/project-new-button";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const params = await searchParams;
  const { projects, clients, payments } = await getProjectsWithClients();

  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-10">
      <PageHeader
        title="Projects"
        description="Drag a card between lanes to update its status."
        actions={<ProjectNewButton clients={clients} openInitial={params.new === "1"} />}
      />

      <div className="mt-8">
        {clients.length === 0 ? (
          <EmptyState
            icon={KanbanSquare}
            title="Add a client first"
            description="Projects belong to clients — add at least one before you create a project."
            action={
              <LinkButton href="/clients?new=1">
                <Plus className="mr-1.5 h-4 w-4" />
                Add client
              </LinkButton>
            }
          />
        ) : (
          <KanbanBoard projects={projects} clients={clients} payments={payments} />
        )}
      </div>
    </div>
  );
}
