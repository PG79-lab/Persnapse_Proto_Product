import { restoreBusinessCardImage } from "../../card_recognition/restore-image";
import { orderCardCorners } from "../../card_recognition/geometry";

// Only bundled by the local evaluator, never exposed by the application.
Object.assign(window, {
  cardBoundaryBenchmark: { restoreBusinessCardImage, orderCardCorners },
});
