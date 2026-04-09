import React, { useState, useRef, useEffect } from "react";

interface ArtifactFrameProps {
	title: string;
	children: React.ReactNode;
	toolbar?: React.ReactNode;
	className?: string;
	contentClassName?: string;
	onCopy?: () => void;
}

export function ArtifactFrame({
	title,
	children,
	toolbar,
	className = "",
	contentClassName = "bg-white",
	onCopy,
}: ArtifactFrameProps) {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// Handle escape key to exit fullscreen
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isFullscreen) {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	return (
		<div
			ref={containerRef}
			className={`artifact-frame flex flex-col h-full bg-slate-900 ${isFullscreen ? "fixed inset-0 z-50 p-4" : ""} ${className}`}
		>
			<div className="flex justify-between items-center p-2 bg-white border-b border-slate-300 shrink-0 gap-4 h-10">
				<div className="font-bold text-sm text-slate-700 shrink-0 truncate" title={title}>
					{title}
				</div>

				<div className="flex items-center gap-4 h-full">
					{toolbar}

					{onCopy && (
						<button
							onClick={onCopy}
							className="px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 font-medium text-slate-600 transition-colors"
							title="Copy content"
						>
							Copy
						</button>
					)}

					<button
						onClick={() => setIsFullscreen((f) => !f)}
						className="p-1 hover:bg-slate-100 rounded text-slate-600 transition-colors flex items-center justify-center w-6 h-6"
						title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							{isFullscreen ? (
								<>
									<path d="M8 3v3a2 2 0 0 1-2 2H3" />
									<path d="M21 8h-3a2 2 0 0 1-2-2V3" />
									<path d="M3 16h3a2 2 0 0 1 2 2v3" />
									<path d="M16 21v-3a2 2 0 0 1 2-2h3" />
								</>
							) : (
								<>
									<path d="M15 3h6v6" />
									<path d="M9 21H3v-6" />
									<path d="M21 3l-7 7" />
									<path d="M3 21l7-7" />
								</>
							)}
						</svg>
					</button>
				</div>
			</div>

			<div className={`flex-1 overflow-auto relative ${contentClassName} ${isFullscreen ? "" : "max-h-full"}`}>{children}</div>
		</div>
	);
}
