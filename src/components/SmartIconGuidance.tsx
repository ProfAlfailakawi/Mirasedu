import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";

const STORAGE_PREFIX = "miras_smart_icon_guidance_v1_";

/**
 * Checks whether a specific guidance key has already been learned by the user.
 */
export function isGuidanceLearned(key: string): boolean {
  if (typeof window === "undefined" || !key) return true;
  try {
    return localStorage.getItem(STORAGE_PREFIX + key) === "true";
  } catch {
    return false;
  }
}

/**
 * Marks a guidance key as learned in localStorage.
 */
export function markGuidanceLearned(key: string): void {
  if (typeof window === "undefined" || !key) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, "true");
    // Dispatch custom event to notify other mounted components in the same session
    window.dispatchEvent(new CustomEvent("miras_icon_guidance_updated", { detail: { key } }));
  } catch {}
}

/**
 * Determines if the current device is primarily a touch/mobile device.
 */
export function isTouchPointerDevice(): boolean {
  if (typeof window === "undefined") return false;
  const matchesCoarse = window.matchMedia("(pointer: coarse)").matches;
  const hasTouchEvents = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return matchesCoarse || (hasTouchEvents && window.innerWidth <= 1024);
}

export interface SmartIconGuidanceProps {
  guidanceKey: string;
  hint: string;
  placement?: "top" | "bottom";
  disabled?: boolean;
  className?: string;
  children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
}

export function SmartIconGuidance({
  guidanceKey,
  hint,
  placement = "top",
  disabled = false,
  className = "",
  children,
}: SmartIconGuidanceProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [learned, setLearned] = useState<boolean>(() => isGuidanceLearned(guidanceKey));
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    actualPlacement: "top" | "bottom";
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state if learned status changes globally
  useEffect(() => {
    const handleGlobalUpdate = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail?.key === guidanceKey) {
        setLearned(true);
        setShowTooltip(false);
      }
    };
    window.addEventListener("miras_icon_guidance_updated", handleGlobalUpdate);
    return () => {
      window.removeEventListener("miras_icon_guidance_updated", handleGlobalUpdate);
    };
  }, [guidanceKey]);

  // Recalculate fixed portal coordinates with viewport clamping (gutter: 12px)
  const updatePosition = () => {
    if (!containerRef.current) return;

    const targetRect = containerRef.current.getBoundingClientRect();
    const targetCenterX = targetRect.left + targetRect.width / 2;

    const tooltipEl = tooltipRef.current;
    const ttWidth = tooltipEl ? tooltipEl.offsetWidth : 180;
    const ttHeight = tooltipEl ? tooltipEl.offsetHeight : 54;

    const GUTTER = 12;
    const viewportWidth = window.innerWidth;

    let actualPlacement: "top" | "bottom" = placement;
    if (placement === "top" && targetRect.top - ttHeight - GUTTER < 0) {
      actualPlacement = "bottom";
    }

    const calculatedTop =
      actualPlacement === "top"
        ? Math.max(GUTTER, targetRect.top - ttHeight - 10)
        : Math.min(window.innerHeight - ttHeight - GUTTER, targetRect.bottom + 10);

    const idealLeft = targetCenterX - ttWidth / 2;
    const calculatedLeft = Math.max(
      GUTTER,
      Math.min(idealLeft, viewportWidth - ttWidth - GUTTER)
    );

    const arrowRelativeX = targetCenterX - calculatedLeft;
    const clampedArrowLeft = Math.max(16, Math.min(arrowRelativeX, ttWidth - 16));

    setCoords({
      top: calculatedTop,
      left: calculatedLeft,
      arrowLeft: clampedArrowLeft,
      actualPlacement,
    });
  };

  // Reposition on mount/show, scroll, or resize
  useLayoutEffect(() => {
    if (showTooltip) {
      updatePosition();
      const handleScrollOrResize = () => updatePosition();
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
      return () => {
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [showTooltip, placement, hint]);

  // Auto-dismiss tooltip after 3.8 seconds
  useEffect(() => {
    if (showTooltip) {
      timerRef.current = setTimeout(() => {
        setShowTooltip(false);
      }, 3800);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showTooltip]);

  const handleIntercept = (e: React.MouseEvent) => {
    if (disabled) return;

    const isTouch = isTouchPointerDevice();
    const currentlyLearned = learned || isGuidanceLearned(guidanceKey);

    if (isTouch && !currentlyLearned) {
      // First tap on mobile: Intercept click, show guidance tooltip in portal, mark as learned!
      e.preventDefault();
      e.stopPropagation();

      markGuidanceLearned(guidanceKey);
      setLearned(true);
      setShowTooltip(true);
      return;
    }

    // Subsequent taps or desktop: Hide tooltip if visible, execute action
    if (showTooltip) {
      setShowTooltip(false);
    }

    if (children.props.onClick) {
      children.props.onClick(e);
    }
  };

  const child = React.cloneElement(children, {
    onClick: handleIntercept,
  });

  return (
    <div
      ref={containerRef}
      className={`inline-flex items-center justify-center ${className}`}
    >
      {child}

      {/* Render tooltip via React Portal in document.body with fixed positioning */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showTooltip && (
              <motion.div
                ref={tooltipRef}
                initial={{ opacity: 0, scale: 0.88, y: coords?.actualPlacement === "top" ? 6 : -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, y: coords?.actualPlacement === "top" ? 6 : -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  top: coords ? `${coords.top}px` : "-9999px",
                  left: coords ? `${coords.left}px` : "-9999px",
                  zIndex: 999999,
                  maxWidth: "220px",
                  minWidth: "135px",
                  width: "max-content",
                }}
                className="pointer-events-none bg-slate-950/95 text-slate-100 text-[11px] font-medium px-3.5 py-2 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md text-center leading-tight dir-rtl whitespace-normal select-none"
              >
                <div className="flex items-center justify-center gap-1 text-amber-300 font-bold mb-0.5 text-[10px]">
                  <span>💡</span>
                  <span>تلميح لأول مرة</span>
                </div>
                <div className="text-slate-100 font-medium leading-snug">{hint}</div>

                {/* Arrow Pointer positioned accurately to match target button center */}
                {coords && (
                  <div
                    className={`absolute border-4 border-transparent ${
                      coords.actualPlacement === "top"
                        ? "top-full -mt-px border-t-slate-950/95"
                        : "bottom-full -mb-px border-b-slate-950/95"
                    }`}
                    style={{
                      left: `${coords.arrowLeft}px`,
                      transform: "translateX(-50%)",
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
