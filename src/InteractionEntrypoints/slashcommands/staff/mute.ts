import { CommandError } from "../../../Configuration/definitions";
import { addMilliseconds, millisecondsToMinutes } from "date-fns";
import { EmbedBuilder, ApplicationCommandOptionType } from "discord.js";
import parseDuration from "parse-duration";
import { roles } from "../../../Configuration/config";
import F from "../../../Helpers/funcs";
import { prisma } from "../../../Helpers/prisma-init";
import { SlashCommand } from "../../../Structures/EntrypointSlashCommand";
import { MessageTools } from "../../../Helpers";

const command = new SlashCommand(<const>{
    description: "Mutes a user",
    options: [
        { name: "user", description: "The user to mute", required: true, type: ApplicationCommandOptionType.User },
        {
            name: "time",
            description: 'A duration string, like "4 hours and 30 minutes". A number by itself is interpreted as hours',
            required: true,
            type: ApplicationCommandOptionType.String
        },
        {
            name: "reason",
            description: "Reason for muting",
            required: false,
            type: ApplicationCommandOptionType.String
        }
    ]
});

command.setHandler(async (ctx) => {
    const { user, time, reason } = ctx.opts;
    await ctx.deferReply();

    const timeStr = isNaN(+time) ? time : `${time}hr`; // Interpret a number by itself as hours

    const durationMs = parseDuration(timeStr);
    if (!durationMs) throw new CommandError("Unable to parse duration.");

    const endsAt = addMilliseconds(new Date(), durationMs);

    const member = await ctx.member.guild.members.fetch(user);
    if (member.roles.cache.has(roles.staff)) throw new CommandError("Staff cannot be muted");

    await member.roles.add(roles.muted);
    await member.roles.remove(roles.banditos);

    // Mark any current timeouts as finished (i.e. new timeout overrides any old ones)
    await prisma.mute.updateMany({
        where: { mutedUserId: member.id },
        data: { finished: true }
    });

    // Add new timeout
    await prisma.mute.create({
        data: {
            mutedUserId: member.id,
            endsAt,
            issuedByUserId: ctx.member.id,
            channelId: ctx.channel.id,
            reason
        }
    });

    const inMinutes = millisecondsToMinutes(durationMs);
    const timestamp = F.discordTimestamp(endsAt, "shortDateTime");
    const embed = new EmbedBuilder()
        .setDescription(`${member} has been timed out for ${timeStr} (${inMinutes} minutes)`)
        .addFields([{ name: "Ends at", value: timestamp }]);
    await ctx.send({ embeds: [embed] });

    // Message timed out member
    const dmEmbed = new EmbedBuilder()
        .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
        .setDescription(
            `You have been muted until ${timestamp}. You can always message the server moderators if you feel there has been a mistake.`
        );

    await MessageTools.safeDM(member, { embeds: [dmEmbed] });
});

export default command;
