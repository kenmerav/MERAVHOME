import { useEffect, useState } from "react";
import {
  BOARD_HEADER_FONT,
  BOARD_HEADER_LETTER_SPACING,
  DESIGN_BOARD_LOGO,
  designBoardBranding,
  designBoardLogoRect,
  designBoardTitleLayout,
  type BrandingPage,
} from "@/lib/designBoardBranding";

export function DesignBoardBranding({
  page,
  roomName,
}: {
  page: BrandingPage;
  roomName?: string | null;
}) {
  const { title } = designBoardBranding(page, roomName);
  const logoRect = designBoardLogoRect();
  const [measured, setMeasured] = useState<{ title: string; layout: ReturnType<typeof designBoardTitleLayout> }>();
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx || cancelled) return;
      setMeasured({ title, layout: designBoardTitleLayout(title, (text, size) => {
        ctx.font = `${size}px ${BOARD_HEADER_FONT}`;
        return ctx.measureText(text).width;
      }) });
    });
    return () => { cancelled = true; };
  }, [title]);
  const layout = measured?.title === title ? measured.layout : designBoardTitleLayout(title);
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
      style={{ zIndex: 999_990 }}
      viewBox="0 0 1400 900"
      preserveAspectRatio="none"
      data-board-branding
      aria-label={`MERAV Interiors — ${title}`}
    >
      <image
        href={DESIGN_BOARD_LOGO}
        x={logoRect.x} y={logoRect.y} width={logoRect.width} height={logoRect.height}
        preserveAspectRatio="xMidYMid meet"
        data-board-logo
      />
      <text
        data-board-room-name
        textAnchor="end"
        dominantBaseline="central"
        fill="#000000"
        fontFamily={BOARD_HEADER_FONT}
        fontSize={layout.fontSize}
        fontWeight={400}
        letterSpacing={BOARD_HEADER_LETTER_SPACING}
      >
        {layout.lines.map((line, index) => <tspan key={index} x={line.x} y={line.y}>{line.text}</tspan>)}
      </text>
    </svg>
  );
}
