import { getLettersPageData } from "@/lib/data/queries";
import { LettersView } from "./_components/letters-view";

export const metadata = { title: "Letters" };

export default async function LettersPage() {
  const { letters, milestones, receipts, shifts } = await getLettersPageData();
  return (
    <LettersView
      letters={letters}
      milestones={milestones}
      receipts={receipts}
      shifts={shifts}
    />
  );
}
