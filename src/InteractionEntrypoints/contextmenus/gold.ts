import { addDays } from "date-fns";
import {
    ContextMenuInteraction,
    Message,
    MessageActionRow,
    MessageButton,
    MessageComponentInteraction,
    MessageEmbed,
    TextChannel
} from "discord.js";
import { channelIDs, emojiIDs } from "../../Configuration/config";
import { CommandError, NULL_CUSTOM_ID } from "../../Configuration/definitions";
import F from "../../Helpers/funcs";
import { prisma } from "../../Helpers/prisma-init";
import { ContextMenu, MessageContextMenu } from "../../Structures/EntrypointContextMenu";
import { TimedInteractionListener } from "../../Structures/TimedInteractionListener";

const GOLD_COST = 5000;
const ADDITIONAL_GOLD_COST = 1000;
const NUM_GOLDS_FOR_CERTIFICATION = 5;
const NOT_CERTIFIED_FIELD = "⚠️ Not certified!";

const ctxMenu = new MessageContextMenu("🪙 Gold Message");

ctxMenu.setHandler(async (ctx, msg) => {
    if (!msg.member) throw new Error("Could not find member");

    await ctx.deferReply({ ephemeral: true });

    // Ensure the message hasn't already been golded
    const givenGold = await prisma.gold.findFirst({ where: { messageId: msg.id } });
    if (givenGold) {
        const embed = new MessageEmbed().setDescription(
            `This message has already been given gold! You can give it an additional gold by pressing the button on the post in <#${channelIDs.houseofgoldtest}>.`
        );
        const actionRow = new MessageActionRow().addComponents([
            new MessageButton({ label: "View post", style: "LINK", url: givenGold.goldMessageUrl })
        ]);

        return ctx.editReply({ embeds: [embed], components: [actionRow] });
    }

    await handleGold(ctx, msg);
});

const genAdditionalGoldId = ctxMenu.addInteractionListener(
    "additionalGold",
    <const>["originalUserId"],
    async (ctx, args) => {
        await ctx.deferReply({ ephemeral: true });
        await handleGold((<unknown>ctx) as typeof ContextMenu.GenericContextType, ctx.message, args.originalUserId);
    }
);

async function handleGold(ctx: typeof ContextMenu.GenericContextType, msg: Message, originalUserId?: string) {
    console.log("here");
    if (!msg.member) return;

    const isAdditionalGold = !!originalUserId;
    const cost = isAdditionalGold ? ADDITIONAL_GOLD_COST : GOLD_COST;

    const originalMember = isAdditionalGold ? await ctx.member.guild.members.fetch(originalUserId) : msg.member;

    const goldBaseEmbed = isAdditionalGold
        ? msg.embeds[0]
        : new MessageEmbed()
              .setAuthor(originalMember.displayName, originalMember.user.displayAvatarURL())
              .setColor("#FCE300")
              .addField("Channel", `${msg.channel}`, true)
              .addField("Posted", F.discordTimestamp(new Date(), "shortDateTime"), true)
              .addField("Message", msg.content)
              .setFooter(`Given by ${ctx.member.displayName}.`, ctx.user.displayAvatarURL());

    let askEmbed = new MessageEmbed(goldBaseEmbed).addField("\u200b", "**Would you like to give gold to this message?**"); // prettier-ignore
    if (isAdditionalGold) {
        askEmbed = new MessageEmbed()
            .setAuthor(originalMember.displayName, originalMember.user.displayAvatarURL())
            .setColor("#FCE300")
            .setDescription("Would you like to add another gold to this message?");
    }

    const timedListener = new TimedInteractionListener(ctx, <const>["goldCtxYes", "goldCtxNo"]);
    const [yesId, noId] = timedListener.customIDs;

    const actionRow = new MessageActionRow().addComponents([
        new MessageButton({
            label: `Yes (${cost} credits)`,
            emoji: emojiIDs.gold,
            style: "PRIMARY",
            customId: yesId
        }),
        new MessageButton({ label: "No", style: "SECONDARY", customId: noId })
    ]);

    await ctx.editReply({
        embeds: [askEmbed],
        components: [actionRow]
        // ephemeral: true
    });

    const buttonPressed = await timedListener.wait();

    if (buttonPressed !== yesId) {
        throw new CommandError(
            "You chose not to give gold. That's okay, sometimes we make decisions that don't work out and that's 100% valid. If you want to give gold again in the future, don't hesitate to reclick that context menu button to share your appreciation of that person's post. They would probably appreciate it a lot. Please give me your credits."
        );
    }

    const chan = (await msg.guild?.channels.fetch(channelIDs.houseofgoldtest)) as TextChannel;
    if (!chan) throw new Error("Couldn't find the gold channel");

    const numGolds = 1 + (isAdditionalGold ? await prisma.gold.count({ where: { goldMessageUrl: msg.url } }) : 0);

    const goldGiven = isAdditionalGold ? await prisma.gold.findFirst({ where: { goldMessageUrl: msg.url } }) : null;
    const goldGivenUrl = goldGiven ? `https://discord.com/channels/${ctx.member.guild.id}/${goldGiven.channelId}/${goldGiven.messageId}` : null; // prettier-ignore

    const goldActionRow = new MessageActionRow().addComponents([
        new MessageButton({
            label: `${numGolds} Gold${F.plural(numGolds)}`,
            emoji: emojiIDs.gold,
            style: "PRIMARY",
            customId: genAdditionalGoldId({ originalUserId: originalUserId ?? msg.author.id })
        }),
        new MessageButton({ label: "View message", style: "LINK", url: goldGivenUrl || msg.url })
    ]);

    const goldEmbed = new MessageEmbed(goldBaseEmbed);
    const idx = goldEmbed.fields.findIndex((f) => f.name === NOT_CERTIFIED_FIELD);
    if (idx !== -1) goldEmbed.spliceFields(idx, 1);

    if (numGolds < NUM_GOLDS_FOR_CERTIFICATION) {
        const remain = NUM_GOLDS_FOR_CERTIFICATION - numGolds;
        const date = isAdditionalGold ? msg.createdAt : new Date();

        goldEmbed.addField(
            "⚠️ Not certified!",
            `This post needs ${remain} more gold${F.plural(remain)}, or it will be deleted ${F.discordTimestamp(
                addDays(date, 1),
                "relative"
            )}`
        );
    }

    const goldMessage = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({ where: { id: ctx.user.id }, data: { credits: { decrement: cost } } });
        if (user.credits < 0) throw new CommandError("You don't have enough credits!");

        const payload = { embeds: [goldEmbed], components: [goldActionRow] };
        const m = isAdditionalGold ? await msg.edit(payload) : await chan.send(payload);

        await tx.gold.create({
            data: {
                messageId: msg.id,
                channelId: msg.channel.id,
                fromUserId: ctx.user.id,
                toUserId: originalMember.id,
                goldMessageUrl: m.url
            }
        });

        return m;
    }, {timeout: 15000, maxWait: 15000}); // prettier-ignore

    const replyEmbed = new MessageEmbed().setDescription("Gold successfully given");

    const replyActionRow = new MessageActionRow().addComponents([
        new MessageButton({ label: "View post", style: "LINK", url: goldMessage.url })
    ]);

    ctx.editReply({ embeds: [replyEmbed], components: isAdditionalGold ? [] : [replyActionRow] });
}

export default ctxMenu;
