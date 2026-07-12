import MarketingNav from "./MarketingNav";
export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h1 className="font-display text-5xl font-black tracking-tighter mb-4">Pricing</h1>
        <p className="text-muted-foreground">See detailed pricing on the landing page.</p>
      </div>
    </div>
  );
}
