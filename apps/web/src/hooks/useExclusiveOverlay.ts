"use client";

// hooks/useExclusiveOverlay.ts — P21-T6-02: 단일-오픈 오버레이 primitive.
// open() 시 overlay-registry 에 등록해 이전에 열려있던 다른 오버레이를 닫는다.
import { useCallback, useEffect, useId, useState } from "react";
import { closeOverlay, openOverlay } from "../lib/overlay-registry";

export function useExclusiveOverlay(id?: string): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
} {
  const generatedId = useId();
  const instanceId = id ?? generatedId;
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    openOverlay(instanceId, () => setIsOpen(false));
    setIsOpen(true);
  }, [instanceId]);

  const close = useCallback(() => {
    closeOverlay(instanceId);
    setIsOpen(false);
  }, [instanceId]);

  useEffect(() => {
    return () => {
      closeOverlay(instanceId);
    };
  }, [instanceId]);

  return { isOpen, open, close };
}
