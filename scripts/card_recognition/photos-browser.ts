import { CardInferenceClient } from "../../card_recognition/runtime/inference-client";
import { restoreBusinessCardImage } from "../../card_recognition/restore-image";
import { orderCardCorners } from "../../card_recognition/geometry";

Object.assign(window, {
  photoBenchmark: {
    CardInferenceClient,
    restoreBusinessCardImage,
    orderCardCorners,
  },
});
