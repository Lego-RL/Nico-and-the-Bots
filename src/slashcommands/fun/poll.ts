import { CommandOptions, CommandRunner } from "configuration/definitions";
import { Poll } from "database/entities/Poll";
import { EmbedField, MessageEmbed } from "discord.js";
import EmojiReg from "emoji-regex";
import { MessageTools } from "helpers";
import { ApplicationCommandOption, ButtonStyle, CommandOptionType, ComponentType } from "slash-create";
import progressBar from "string-progressbar";

const REQUIRED_OPTIONS = <const>[1, 2];
const OPTIONAL_OPTIONS = <const>[3, 4, 5, 6, 7, 8, 9, 10];

// [1, 2, 3,...] => { option1: string, option2: string, option3: string, ... }
type OPTIONS_OF<T extends Readonly<Array<number>>> = Record<`option${T[number]}`, string>;

type OptType = { title: string } & OPTIONS_OF<typeof REQUIRED_OPTIONS> & Partial<OPTIONS_OF<typeof OPTIONAL_OPTIONS>>;

const OPTIONS = [...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS];
export const Options: CommandOptions = {
    description: "Creates a message that users can react to to receive a role",
    options: [
        {
            name: "title",
            description: "The title for the poll",
            required: true,
            type: CommandOptionType.STRING
        },
        ...OPTIONS.map(
            (opt) =>
                <ApplicationCommandOption>{
                    name: `option${opt}`,
                    description: `Option #${opt}. If you want the button to have an emoji, set it as the first character in this option.`,
                    required: opt <= 2, // Need at least two options for a poll
                    type: CommandOptionType.STRING
                }
        )
    ]
};

type ParsedOption = { text: string; emoji?: string; emojiID?: string };
export const Executor: CommandRunner<OptType> = async (ctx) => {
    await ctx.defer();

    const { title, ...optDict } = ctx.opts;

    const options = <string[]>(
        OPTIONS.map((num) => optDict[`option${num}` as `option${typeof OPTIONS[number]}`]).filter(
            (opt) => opt !== undefined
        )
    );

    const discordEmojiRegex = /<a{0,1}:(?<name>.*?):(?<id>\d+)>/;

    const parsedOptions: ParsedOption[] = [];

    for (const option of options) {
        const discordMatch = discordEmojiRegex.exec(option);

        // Has valid Discord emoji
        if (discordMatch?.index === 0) {
            const emoji = discordMatch[0];
            const { name, id } = discordMatch.groups as { name: string; id: string };
            console.log({ emoji: id });
            parsedOptions.push({ text: option.replace(emoji, "").trim(), emoji: name, emojiID: id });
        }
        // Doesn't have a Discord emoji, might have a unicode emoji
        else {
            const emojiReg = EmojiReg();
            const possibleEmoji = option.split(" ")[0];
            const isEmoji = emojiReg.test(possibleEmoji);
            const text = isEmoji ? option.split(" ").slice(1).join(" ") : option;
            const emoji = isEmoji ? possibleEmoji : undefined;
            parsedOptions.push({ text, emoji });
        }
    }

    const poll = new Poll({
        id: ctx.interactionID,
        userid: ctx.user.id
    });

    // TODO: No real point in saving it since the bot doesn't respond to old interactions
    // await ctx.connection.manager.save(poll);

    const embed = new MessageEmbed()
        .setTitle(title)
        .setAuthor(ctx.member.displayName, ctx.user.avatarURL)
        .setFooter(
            "Press one of the buttons below to vote. Your vote will be reflected in the message stats, and you can only vote once."
        );

    embed.fields = generateStatsDescription(poll, parsedOptions);

    const components = MessageTools.allocateButtonsIntoRows(
        parsedOptions.map((opt, idx) => ({
            type: ComponentType.BUTTON,
            style: ButtonStyle.PRIMARY,
            label: opt.text,
            custom_id: `option${idx + 1}`,
            emoji: { name: opt.emoji, id: opt.emojiID }
        }))
    );

    await ctx.send({ embeds: [embed.toJSON()], components });

    // Generate handlers for buttons
    for (let i = 0; i < parsedOptions.length; i++) {
        ctx.registerComponent(`option${i + 1}`, async (btnCtx) => {
            // Ensure user hasn't voted
            const userVote = poll.votes.find((vote) => vote.userid === btnCtx.user.id);

            // Editing
            if (userVote) userVote.index = i;
            // Cast new vote
            else poll.votes.push({ index: i, userid: btnCtx.user.id });

            embed.fields = generateStatsDescription(poll, parsedOptions);

            btnCtx.editOriginal({ embeds: [embed.toJSON()] });
        });
    }
};

function generateStatsDescription(poll: Poll, parsedOptions: ParsedOption[]): EmbedField[] {
    // Calculate votes for each option
    const votes = parsedOptions.map((_) => 0);
    const totalVotes = poll.votes.length;

    for (const vote of poll.votes) {
        votes[vote.index]++;
    }

    const tempEmbed = new MessageEmbed();

    parsedOptions.forEach((opt, idx) => {
        const [progress] = progressBar.filledBar(totalVotes === 0 ? 1 : totalVotes, votes[idx], 20);
        let emoji = "";
        if (opt.emojiID) emoji = `<a:${opt.emoji}:${opt.emojiID}>`;
        else if (opt.emoji) emoji = opt.emoji;

        tempEmbed.addField(`${emoji} ${opt.text}`.trim(), `${progress} [${votes[idx]}/${totalVotes}]`);
    });

    return tempEmbed.fields;
}
