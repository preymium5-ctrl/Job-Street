import { permanentRedirect } from "next/navigation";

export default function PreviousEventPage() {
  permanentRedirect("/jobs");
}
