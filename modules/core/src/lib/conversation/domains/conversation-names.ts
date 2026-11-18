/**
 * The names of the contract of a conversation with a model: the domains of its steps, the parameters of the steps that send a
 * turn, read a session and keep a file, and the superclass of its models' type. A page finds the steps by these names without
 * the schemas of a session.
 */
/** The domains of a conversation's steps. */
export const CONVERSATION_DOMAIN = {
	/** What a turn sends beside its words: the envelope of its records, view, session and delegation. */
	QUESTION: "conversation-question",
	/** A model's response, which a turn streams. */
	RESPONSE: "conversation-response",
	/** A session's turns, read back. */
	SESSION: "conversation-session",
	/** The sessions a store holds. */
	SESSIONS: "conversation-sessions",
	/** A key made for one turn, and what a turn takes beyond its read. */
	TURN_KEY: "conversation-turn-key",
	/** The record a file a person adds to a question is kept as. */
	FILE: "conversation-file",
} as const;

/** The parameters of the step that sends a turn: the model, the read level of its records, the words, and the question. */
export const ASK_PARAM = { model: "target", readLevel: "accessLevel", prompt: "prompt", question: "context" } as const;
/** The parameter of the step that reads a session: the session, named by its first question's record. */
export const SESSION_PARAM = "session";
/** The parameters of the step that keeps a question's file: its bytes as a data: URL, and its name. */
export const FILE_PARAM = { file: "file", name: "name" } as const;

/** The class that the type of a conversation stepper's models states itself a kind of: a client finds that type by it. */
export const CONVERSATION_MODEL_CLASS = "hbn:ConversationModel";
