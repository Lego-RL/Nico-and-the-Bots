import { roles, userIDs } from "../../../../Configuration/config";
import { CommandError } from "../../../../Configuration/definitions";
import { MessageEmbed } from "discord.js";
import { SlashCommand } from "../../../../Structures/EntrypointSlashCommand";
import F from "../../../../Helpers/funcs";
import { prisma } from "../../../../Helpers/prisma-init";
import { NodeBuilderFlags } from "typescript";

const EditTypes = <const>["REPLACE", "ADD"];

const inputs = <const>["credits", "score", "tokens", "steals", "blocks", "dailycount"];

const command = new SlashCommand(<const>{
    description: "Edits a user's economy",
    options: [
        {
            name: "user",
            description: "The user whose economy you wish to edit",
            required: true,
            type: "USER"
        },
        {
            name: "type",
            description: "IMPORTANT: Whether to REPLACE or ADD these values to the econ",
            required: true,
            type: "STRING",
            choices: EditTypes.map((t) => ({ name: t, value: t }))
        },
        ...inputs.map(
            (name) =>
                <const>{
                    name,
                    description: `Value of ${name} to add or replace`,
                    required: false,
                    type: "INTEGER"
                }
        )
    ]
});

console.log(command.commandData.options, /OPTS/);

command.setHandler(async (ctx) => {
    if (ctx.user.id !== userIDs.me) throw new CommandError("No");

    await ctx.deferReply();
    const { user, type, credits, score, tokens, steals, blocks, dailycount } = ctx.opts;
    const amountField = (n: number | undefined) => {
        if (n === undefined) return undefined;

        return type === "ADD" ? { increment: n } : n;
    };

    const member = await ctx.guild.members.fetch(user);
    if (!member) throw new CommandError("Couldn't find that member");

    const embed = new MessageEmbed()
        .setAuthor(member.displayName, member.displayAvatarURL())
        .setColor(member.displayColor)
        .setTitle("Edit successful");

    await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
            where: { id: user },
            data: {
                credits: amountField(credits),
                score: amountField(score),
                dailyBox: {
                    update: {
                        tokens: amountField(tokens),
                        steals: amountField(steals),
                        blocks: amountField(blocks),
                        dailyCount: amountField(dailycount)
                    }
                }
            },
            include: { dailyBox: true }
        });

        (<const>["credits", "score"]).forEach((v) => {
            const value = result[v] as number;
            if (value < 0) throw new CommandError(`These actions would cause ${v} to go negative.`);

            embed.addField(v, `${value}`, true);
        });

        (<const>["steals", "blocks", "tokens", "dailyCount"]).forEach((v) => {
            const value = result.dailyBox?.[v] as number;
            if (value < 0) throw new CommandError(`These actions would cause ${v} to go negative.`);

            embed.addField(v, `${value}`, true);
        });
    });

    await ctx.editReply({ embeds: [embed] });
});

export default command;
