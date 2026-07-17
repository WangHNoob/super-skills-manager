/** 悬停说明：复杂概念用短句解释，避免界面堆砌术语 */
export default function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} tabIndex={0} aria-label={text}>
      ?
    </span>
  );
}
