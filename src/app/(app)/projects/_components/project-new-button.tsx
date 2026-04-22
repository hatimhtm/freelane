"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectDialog } from "./project-dialog";
import type { Client } from "@/lib/supabase/types";

export function ProjectNewButton({
  clients,
  openInitial,
}: {
  clients: Client[];
  openInitial?: boolean;
}) {
  const [open, setOpen] = useState(openInitial ?? false);
  useEffect(() => { if (openInitial) setOpen(true); }, [openInitial]);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New project
      </Button>
      <ProjectDialog open={open} onOpenChange={setOpen} clients={clients} />
    </>
  );
}
