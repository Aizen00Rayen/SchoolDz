import { motion } from "framer-motion";

/**
 * Sticky-stacking feature cards: each card locks to the same scroll position
 * and gets covered by the next one as the user scrolls, producing a stack/flip
 * effect. `features` items: { title, description, imageUrl, icon, className }.
 */
export function StickyFeatureCards({ features, stickyTop = 96 }) {
  return (
    <div className="w-full">
      {features.map((feature, index) => (
        <motion.div
          key={feature.title}
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`sticky grid grid-cols-1 md:grid-cols-2 items-center gap-8 md:gap-14 p-8 md:p-14 rounded-3xl mb-6 border ${feature.className || "bg-card border-border"}`}
          style={{ top: stickyTop, zIndex: index + 1 }}
        >
          <div className="flex flex-col justify-center order-2 md:order-1">
            {feature.icon && (
              <div className="w-11 h-11 rounded-xl grid place-items-center mb-5 bg-accent/10 text-accent">
                <feature.icon className="w-5 h-5" />
              </div>
            )}
            <h3 className="font-display text-2xl md:text-3xl font-bold mb-3 tracking-tight text-foreground">
              {feature.title}
            </h3>
            <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
          </div>

          <div className="order-1 md:order-2 overflow-hidden rounded-2xl">
            <img
              src={feature.imageUrl}
              alt={feature.title}
              loading="lazy"
              className="w-full h-56 md:h-80 object-cover"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = "https://placehold.co/800x600/e5e5e5/999999?text=Scolaris";
              }}
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
