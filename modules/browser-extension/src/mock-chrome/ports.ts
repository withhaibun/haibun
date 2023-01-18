export namespace Helpers {
    export function arrayHasCallback(array: Function[], callback: Function): boolean {
        for (let i = 0; i < array.length; i++) {
            const currentCallback = array[i];

            if (currentCallback.toString() === callback.toString()) {
                return true;
            }
        }

        return false;
    }

    export function removeCallbackFromArray(array: Function[], callback: Function): Function[] {
        return array.filter(item => {
            return item.toString() !== callback.toString();
        });
    }
}