import { Mutex } from "async-mutex";
import { constants } from "configuration/config";
import { CommandComponentListener, CommandOption, CommandRunner, ExtendedContext } from "configuration/definitions";
import { Poll } from "database/entities/Poll";
import {
    Collection,
    CollectorFilter,
    Interaction,
    Message,
    MessageActionRow,
    MessageButton,
    MessageComponentInteraction,
    MessageComponentInteractionCollector,
    Snowflake,
    TextChannel
} from "discord.js";
import { ComponentActionRow, ComponentButton, ComponentType } from "slash-create";
import F from "./funcs";

export const MessageTools = {
    async awaitMessage(userID: string, channel: TextChannel, timeMS: number): Promise<Message | null> {
        const filter = (m: Message) => m.author.id === userID;
        try {
            const collected = await channel.awaitMessages(filter, { max: 1, time: timeMS, errors: ["time"] });
            const awaitedMessage = collected.first();

            return awaitedMessage || null;
        } catch (e) {
            return null;
        }
    },

    /** Takes an array of buttons and places them into an array of Action Row components */
    allocateButtonsIntoRows<T extends ComponentActionRow | MessageActionRow>(buttons: T["components"][number][]): T[] {
        const components: T[] = [];

        if (buttons.length > constants.ACTION_ROW_MAX_ITEMS * constants.MAX_ACTION_ROWS)
            throw new Error("Too many buttons");

        for (let i = 0; i < buttons.length; i += constants.ACTION_ROW_MAX_ITEMS) {
            const slicedButtons = buttons.slice(i, i + constants.ACTION_ROW_MAX_ITEMS);
            components.push(<T>{
                type: ComponentType.ACTION_ROW,
                components: slicedButtons
            });
        }

        return components;
    },

    async fetchAllMessages(channel: TextChannel, num = Infinity): Promise<Collection<Snowflake, Message>> {
        const MAX_MESSAGES_FETCH = 100;
        let before: Snowflake | undefined = undefined;

        let allMessages: Collection<Snowflake, Message> = new Collection();

        while (allMessages.size < num) {
            const previousSize = allMessages.size;
            const msgs: Collection<Snowflake, Message> = await channel.messages.fetch({ limit: MAX_MESSAGES_FETCH, before }); // prettier-ignore
            allMessages = allMessages.concat(msgs);

            if (allMessages.size === previousSize) break; // No new messages

            before = msgs.last()?.id;
        }

        return allMessages;
    }
};

/** Things that extend a Message object */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function MessageContext(msg: Message) {
    const listeners: Collection<string, MessageComponentInteractionCollector> = new Collection();
    return {
        msg,
        // Copying the functionality of slash create for use with discord.js
        registerComponent(customID: string, handler: (interaction: Interaction) => Promise<void>): void {
            const filter: CollectorFilter<[MessageComponentInteraction]> = (interaction) => interaction.customID === customID; // prettier-ignore
            const collector = msg.createMessageComponentInteractionCollector(filter);

            console.log("Created collector");
            listeners.set(customID, collector);

            collector.on("collect", handler);
            collector.on("end", () => console.log(`${customID} collector ended`));
        },
        unregisterComponent(customID: string): boolean {
            const collector = listeners.get(customID);
            if (!collector) return false;

            collector.stop();
            listeners.delete(customID);
            return true;
        }
    };
}

/**
 * Returns a CommandComponentListener that handles upvote/downvote presses
 * Deletes the original message if too many downvotes
 * @param name The name passed to the CommandComponentListener
 */
export function generateUpvoteDownvoteListener(name: string): CommandComponentListener {
    const answerListener = new CommandComponentListener(name, <const>["isUpvote", "pollID"]);
    const mutex = new Mutex();

    answerListener.handler = async (interaction, connection, args) => {
        mutex.runExclusive(async () => {
            const { isUpvote, pollID } = args;
            const m = interaction.message as Message;

            const poll = await connection.getRepository(Poll).findOne({ id: pollID });
            if (!poll) return;

            const vote = poll.votes.find((v) => v.userid === interaction.user.id);
            if (vote) vote.index = +isUpvote;
            else poll.votes.push({ index: +isUpvote, userid: interaction.user.id });

            await connection.manager.save(poll);

            await updateMessage(m, poll, +isUpvote);
        });
    };

    async function updateMessage(msg: Message, poll: Poll, lastVote: number) {
        const [actionRow] = msg.components;

        let upvotes = 0;
        for (const vote of poll.votes) {
            if (vote.index === 1) upvotes++;
        }
        const downvotes = poll.votes.length - upvotes;

        // If the post is heavily downvoted
        if (downvotes >= Math.max(5, upvotes)) {
            await msg.delete();
        }

        const upvoteButton = actionRow.components.find((c) => typeof c.emoji !== "string" && c.emoji?.name?.startsWith("upvote")); // prettier-ignore
        const downvoteButton = actionRow.components.find((c) => typeof c.emoji !== "string" && c.emoji?.name?.startsWith("downvote")); // prettier-ignore
        if (!upvoteButton || !downvoteButton) return;

        if (lastVote === 0) downvoteButton.setStyle("DANGER");
        else upvoteButton.setStyle("SUCCESS");

        upvoteButton.label = `${upvotes}`;
        downvoteButton.label = `${downvotes}`;

        await msg.edit({ components: [actionRow] });

        await F.wait(1000);

        upvoteButton.setStyle("SECONDARY");
        downvoteButton.setStyle("SECONDARY");

        await msg.edit({ components: [actionRow] });
    }

    return answerListener;
}
