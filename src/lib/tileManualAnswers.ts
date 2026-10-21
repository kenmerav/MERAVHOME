/** Explicit form answers can use the designer's own wording. */
export function tileManualAnswerConfirmed(value: string) {
  return (
    Boolean(value.trim()) &&
    !/\b(?:tbd|tbc|pending|unknown|unsure|undecided|not sure|to be (?:confirmed|selected|determined)|or|versus|choose|select|unselected|unresolved|selection (?:still )?needed|decision needed|confirm (?:the )?(?:grout|pattern|layout)|(?:grout|layout|pattern).{0,30}(?:require|need).{0,15}(?:approval|review|confirm)|not (?:yet )?(?:confirmed|selected|specified))\b/i.test(
      value,
    ) &&
    !/^(?:n\/a|na|none|not applicable|[-—–])$/i.test(value.trim()) &&
    !/\b(?:cancel(?:ed|led)?|superseded|historical reference|reference only|not selected|do not install|not final)\b/i.test(
      value,
    )
  );
}

export function tileJointWidthNeedsUnit(value: string) {
  return tileJointWidthConfirmed(`${value.trim()} mm`);
}

export function tileJointWidthConfirmed(value: string) {
  return (
    tileManualAnswerConfirmed(value) &&
    /^(?:(?:\d+\s+)?\d+\s*\/\s*[1-9]\d*|\d+(?:\.\d+)?|\.\d+|[⅛¼⅜½¾])\s*[-–]?\s*(?:["″]|inch(?:es)?|in|mm|millimet(?:er|re)s?)\.?$/i.test(
      value.trim(),
    ) &&
    /[1-9⅛¼⅜½¾]/.test(value)
  );
}
