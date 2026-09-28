import { createFileRoute } from "@tanstack/react-router";

import { SwearJarPage } from "../components/swearJar/SwearJarPage";

export const Route = createFileRoute("/swear-jar")({
  component: SwearJarPage,
});
