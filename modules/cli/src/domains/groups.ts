/**
 * The groups of features `haibun-cli --groups` runs: what a config's `group` declares, and the selection a command line makes of them.
 */

/** The option that runs groups, and the options that select them and list them. */
export const GROUP_OPTIONS = { groups: "--groups", set: "--set", environments: "--environments", list: "--list" } as const;

/** The file name of a config, which the groups are found among. */
export const CONFIG_FILE = /^config[^/]*\.json$/;

/** A group as its config declares it: the config by its path from where the groups are found, the bases and filter it runs, by path
 *  from the config's directory or by a package's export, the set it runs in, the configs that run before it, the external environments
 *  its features use, and the paths, from the config's directory, removed before it runs. */
export type TGroup = { config: string; bases: string[]; filter: string[]; set: string | undefined; after: string[]; environments: string[]; clears: string[] };

/** What a command line selects: the set its groups run in, the external environments it has, the configs or the directories that
 *  hold them, by their paths, which narrow it, and the feature filter each group runs in place of its own. */
export type TGroupSelection = { set: string | undefined; environments: string[]; within: string[]; filter: string[] };
