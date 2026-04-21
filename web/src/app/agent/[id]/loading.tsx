import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { SkeletonProfile } from "@/components/agent-profile/SkeletonProfile";

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <main className="flex-1">
        <SkeletonProfile />
      </main>
      <Footer />
    </div>
  );
}
