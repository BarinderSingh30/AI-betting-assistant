export function Placeholder(props: { title: string; phase: string }): React.JSX.Element {
  return (
    <div className="page">
      <h2>{props.title}</h2>
      <p>Coming in {props.phase}.</p>
    </div>
  )
}
