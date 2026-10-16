import { createContext } from "react";

// Printing retains the original eager default; long read-only previews can opt in to lazy images.
export const SpecImageLoadingContext = createContext<"eager" | "lazy">("eager");
