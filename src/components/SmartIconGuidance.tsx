import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";

const STORAGE_PREFIX = "miras_smart_icon_guidance_v1_";
const GUTTER = 12;

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
    left: number;
    top: number;
    arrowLeft: number;
    isTopPlacement: boolean;
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (!wrapperRef.current) return;
    const targetRect = wrapperRef.current.getBoundingClientRect();
    const iconCenterX = targetRect.left + targetRect.width / 2;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let tooltipWidth = 180;
    let tooltipHeight = 60;

    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.width > 0) tooltipWidth = rect.width;
      if (rect.height > 0) tooltipHeight = rect.height;
    }

    // Horizontal positioning & clamping inside viewport with 12px gutter
    const idealLeft = iconCenterX - tooltipWidth / 2;
    const minLeft = GUTTER;
    const maxLeft = Math.max(GUTTER, viewportWidth - GUTTER - tooltipWidth);
    const actualLeft = Math.min(Math.max(idealLeft, minLeft), maxLeft);

    // Arrow pointer position relative to tooltip box
    const arrowOffsetX = iconCenterX - actualLeft;
    const clampedArrowLeft = Math.min(Math.max(arrowOffsetX, 14), Math.max(14, tooltipWidth - 14));

    // Vertical positioning
    let isTop = placement === "top";
    let actualTop = isTop ? targetRect.top - tooltipHeight - 10 : targetRect.bottom + 10;

    if (isTop && actualTop < GUTTER) {
      isTop = false;
      actualTop = targetRect.bottom + 10;
    } else if (!isTop && actualTop + tooltipHeight > viewportHeight - GUTTER) {
      isTop = true;
      actualTop = targetRect.top - tooltipHeight - 10;
    }

    setCoords({
      left: actualLeft,
      top: actualTop,
      arrowLeft: clampedArrowLeft,
      isTopPlacement: isTop,
    });
  };

  useLayoutEffect(() => {
    if (showTooltip) {
      updatePosition();
      const frame = requestAnimationFrame(() => updatePosition());
      return () => cancelAnimationFrame(frame);
    }
  }, [showTooltip, hint]);

  useEffect(() => {
    if (!showTooltip) return;
    const handleUpdate = () => updatePosition();
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);
    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
    };
  }, [showTooltip]);

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

  // Auto-dismiss tooltip after 3.5 seconds
  useEffect(() => {
    if (showTooltip) {
      timerRef.current = setTimeout(() => {
        setShowTooltip(false);
      }, 3500);
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
      // First tap on mobile: Intercept click, show guidance tooltip, mark as learned!
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

  const isTop = coords?.isTopPlacement ?? (placement === "top");

  return (
    <div ref={wrapperRef} className={`relative inline-flex items-center justify-center ${className}`}>
      {child}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showTooltip && coords && (
              <motion.div
                ref={tooltipRef}
                initial={{ opacity: 0, scale: 0.88, y: isTop ? 6 : -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, y: isTop ? 6 : -6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{
                  position: "fixed",
                  left: `${coords.left}px`,
                  top: `${coords.top}px`,
                  zIndex: 99999,
                  maxWidth: "220px",
                  minWidth: "130px",
                  width: "max-content",
                }}
                className="pointer-events-none bg-slate-950/95 text-slate-100 text-[11px] font-medium px-3.5 py-2 rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md text-center leading-tight dir-rtl whitespace-normal select-none"
              >
                <div className="flex items-center justify-center gap-1 text-amber-300 font-bold mb-0.5 text-[10px]">
                  <span>💡</span>
                  <span>تلميح لأول مرة</span>
                </div>
                <div className="text-slate-100 font-medium leading-snug">{hint}</div>

                {/* Arrow indicator strictly aligned with the center of the icon */}
                <div
                  style={{ left: `${coords.arrowLeft}px` }}
                  className={`absolute -translate-x-1/2 border-4 border-transparent ${
                    isTop
                      ? "top-full -mt-px border-t-slate-950/95"
                      : "bottom-full -mb-px border-b-slate-950/95"
                  }`}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
