/**
 * Turns a script line into text a speech engine reads naturally: no markdown or bracketed directions,
 * symbols and common abbreviations spelled out, and dashes turned into the pauses a speaker would make.
 * Scripts are asked to write for the ear; this catches what slips through.
 */
export function toSpeechText(text: string): string {
  return (
    text
      // Markdown emphasis, headings and stage directions are never spoken.
      .replace(/[*_#`]+/g, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((?:laughs?|pause|music|sighs?|chuckles?)[^)]*\)/gi, ' ')
      // Common written abbreviations.
      .replace(/\be\.g\.,?/gi, 'for example,')
      .replace(/\bi\.e\.,?/gi, 'that is,')
      .replace(/\betc\./gi, 'and so on')
      .replace(/\bvs\.?(?=\s)/gi, 'versus')
      .replace(/(\d)\s*%/g, '$1 percent')
      .replace(/\s&\s/g, ' and ')
      // A dash or ellipsis is a breath, which most engines read best as a comma.
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
      .replace(/\.{3,}|…/g, ', ')
      // Tidy what the replacements leave behind.
      .replace(/,\s*([,.!?])/g, '$1')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/^[\s,]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
