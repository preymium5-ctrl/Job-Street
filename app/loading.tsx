import { BrandMark } from "@/components/ui/Brand";
export default function Loading() {
  return (
    <div className="container loading-page" role="status">
      <BrandMark className="brand-spark" />
      <p>Finding your next opportunity…</p>
    </div>
  );
}
