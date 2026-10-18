import { createRoot } from "react-dom/client";
import { BusinessCardWorkspace } from "../../src/features/capture/business-card-workspace";
import { processBusinessCardImage } from "../../src/features/capture/card-image-processing";

Object.assign(window, { quickPrepare: processBusinessCardImage });

createRoot(document.getElementById("root")!).render(
  <BusinessCardWorkspace
    ocrMode="mock"
    onViewPerson={() => {}}
    onFindMemory={() => {}}
  />,
);
