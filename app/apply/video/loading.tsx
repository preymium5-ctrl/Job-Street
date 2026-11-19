import { BrandMark } from "@/components/ui/Brand";

export default function VideoApplicationLoading() {
  return (
    <div className="container loading-page" role="status">
      <BrandMark className="brand-spark" />
      <p>Preparing your application…</p>
    </div>
  );
}
