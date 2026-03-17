import HeroSection from "@/components/HeroSection";
import Timeline from "@/components/Timeline";
import ClientStories from "@/components/ClientStories";
import ConsultationForm from "@/components/ConsultationForm";

export default function Home() {
  return (
    <main>
      <HeroSection />
      <Timeline />
      <ClientStories />
      <ConsultationForm />
    </main>
  );
}
