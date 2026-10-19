import {
  BOARD_LOGO_RECT,
  BOARD_TITLE_RECT,
  DESIGN_BOARD_LOGO,
  designBoardBranding,
  type BrandingPage,
} from "@/lib/designBoardBranding";

export function DesignBoardBranding({
  page,
  roomName,
}: {
  page: BrandingPage;
  roomName?: string | null;
}) {
  const header = designBoardBranding(page, roomName);
  return (
    <div
      className="pointer-events-none absolute inset-0 select-none"
      style={{ zIndex: 999_990 }}
      data-board-branding
    >
      {header.showLogo && (
        <img
          src={DESIGN_BOARD_LOGO}
          alt="MERAV Interiors by Katie Roberts"
          draggable={false}
          className="absolute object-contain"
          style={{
            left: BOARD_LOGO_RECT.x,
            top: BOARD_LOGO_RECT.y,
            width: BOARD_LOGO_RECT.width,
            height: BOARD_LOGO_RECT.height,
          }}
        />
      )}
      {header.showTitle && (
        <div
          data-board-room-name
          className="absolute flex items-center justify-end whitespace-pre-wrap text-right uppercase leading-tight"
          style={{
            left: BOARD_TITLE_RECT.x,
            top: BOARD_TITLE_RECT.y,
            width: BOARD_TITLE_RECT.width,
            height: BOARD_TITLE_RECT.height,
            color: "#000000",
            fontFamily: "var(--font-montserrat)",
            fontSize: 28,
            letterSpacing: 2,
            overflowWrap: "anywhere",
          }}
        >
          {header.title}
        </div>
      )}
    </div>
  );
}
