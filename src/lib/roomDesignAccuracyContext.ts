import { createContext, useContext } from "react";
import type { DesignAccuracyController } from "@/components/DesignAccuracyPanel";

export const RoomDesignAccuracyContext = createContext<DesignAccuracyController | null>(null);
export const RoomDesignAccuracyRoomContext = createContext("");
export function useRoomDesignAccuracyRoom() {
  return useContext(RoomDesignAccuracyRoomContext);
}
export function useRoomDesignAccuracy() {
  return useContext(RoomDesignAccuracyContext);
}
