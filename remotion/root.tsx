import { Composition } from "remotion";
import { ReadmeDemo } from "./readme-demo";

export function RemotionRoot() {
  return (
    <Composition
      id="ReadmeDemo"
      component={ReadmeDemo}
      durationInFrames={120}
      fps={24}
      width={960}
      height={480}
    />
  );
}
