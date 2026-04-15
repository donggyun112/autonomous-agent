export default function cycleBrief(input: { focus?: string; state?: string; risk?: string; next?: string }) {
  const parts: string[] = [];
  if (input.focus) parts.push(`초점: ${input.focus}`);
  if (input.state) parts.push(`상태: ${input.state}`);
  if (input.risk) parts.push(`리스크: ${input.risk}`);
  if (input.next) parts.push(`다음: ${input.next}`);
  return parts.join(" | ") || "비어 있음";
}
