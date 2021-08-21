/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma, TopfeedPost, TopfeedType } from ".prisma/client";
import { Message, MessageOptions, Snowflake } from "discord.js";
import { NicoClient } from "../../../../app";
import { prisma } from "../../../Helpers/prisma-init";

export interface Checked<T> {
    uniqueIdentifier: string;
    ping: boolean;
    _data: T;
}

export abstract class Watcher<T> {
    constructor(public handle: string, public channel: Snowflake) {}
    abstract type: TopfeedType;

    protected abstract fetchRecentItems(): Promise<Checked<T>[]>;
    public abstract generateMessages(checkedItems: Checked<T>[]): Promise<MessageOptions[][]>;

    protected client = NicoClient;

    async afterCheck(msg: Message): Promise<void> {
        // Override in child to do something
    }

    async #checkItems(items: Checked<T>[]): Promise<Checked<T>[]> {
        const uniqueIDs = items.map((item) => item.uniqueIdentifier);

        const idsThatExist = (
            await prisma.topfeedPost.findMany({
                where: { id: { in: uniqueIDs }, type: this.type },
                select: { id: true }
            })
        ).map((p) => p.id);
        const idSet = new Set(idsThatExist);

        const newItems = items.filter((item) => !idSet.has(item.uniqueIdentifier));

        await prisma.topfeedPost.createMany({
            data: newItems.map((item) => ({
                id: item.uniqueIdentifier,
                type: this.type,
                subtype: (<any>item._data).subtype,
                data: item._data
            }))
        });

        return newItems;
    }

    async fetchNewItems(): Promise<[Checked<T>[], MessageOptions[][]]> {
        const fetchedItems = await this.fetchRecentItems();
        const checkedItems = await this.#checkItems(fetchedItems);
        return [checkedItems, await this.generateMessages(checkedItems)];
    }

    protected async getLatestItem<Subtype extends string>(
        subtype?: Subtype
    ): Promise<(TopfeedPost & { data: T & { subtype: Subtype } }) | null> {
        return prisma.topfeedPost.findFirst({
            where: { type: this.type, subtype },
            orderBy: { createdAt: "desc" }
        }) as unknown as TopfeedPost & { data: T & { subtype: Subtype } };
    }
}
