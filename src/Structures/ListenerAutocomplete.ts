/* eslint-disable @typescript-eslint/no-explicit-any */
import { AutocompleteInteraction, Guild, GuildMember, Snowflake, TextChannel } from "discord.js";
import { ElementOf, PickKeys, PickProperties, Tuple, UnionToIntersection, ValueOf } from "ts-essentials";

type RequiredDiscordValues = {
    member: GuildMember;
    guild: Guild;
    channel: TextChannel;
    guildId: Snowflake;
};

type AutocompleteContext<OptsType, AutocompleteNameOption> = AutocompleteInteraction &
    RequiredDiscordValues & {
        opts: OptsType;
        focused: AutocompleteNameOption;
    };

export type AutocompleteListener<OptsType, RawOptionsData extends Readonly<Tuple>> = (
    ctx: AutocompleteContext<OptsType, AutocompleteNames<RawOptionsData>>
) => Promise<void>;

interface IsAutocomplete {
    autocomplete: true;
    name: string;
}

type AutocompleteNames<RawOptionsData extends Readonly<Tuple>> = {
    [Index in keyof RawOptionsData]: RawOptionsData[Index] extends IsAutocomplete
        ? RawOptionsData[Index]["name"]
        : never;
}[number];

export type AutocompleteNameOption<RawOptionsData extends Readonly<Tuple>> =
    | AutocompleteNames<RawOptionsData>
    | AutocompleteNames<RawOptionsData>[];
