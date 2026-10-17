import { ActionLink } from "@/components/ui/ActionLink";
export default function NotFound() {
  return (
    <div className="container error-page">
      <span className="eyebrow">404 / A different direction</span>
      <h1>
        This page
        <br />
        isn’t here.
      </h1>
      <p>
        The page may have moved, or the opportunity may no longer be available.
      </p>
      <ActionLink href="/jobs">Explore opportunities</ActionLink>
    </div>
  );
}
